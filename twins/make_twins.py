"""Build matched twins from the public GSM-Symbolic templates.

For each template we keep the original GSM8K question (public, likely seen in
training) and generate a twin: same wording, new names and numbers. Unlike the
original GSM-Symbolic data, every number in a twin has the same number of
digits as the number it replaces. A 2026 re-check of GSM-Symbolic found its
variants used larger numbers than the originals, so part of the drop it
reported may have been arithmetic, not memorisation. Matching digit counts
removes that excuse.

Templates are read from a local clone of apple/ml-gsm-symbolic, which this
repo does not redistribute:

    git clone --depth 1 https://github.com/apple/ml-gsm-symbolic
    python3 twins/make_twins.py ml-gsm-symbolic/templates/symbolic out/pairs.jsonl

Template expressions are evaluated with a small AST walker that only knows
arithmetic, comparisons and a handful of helpers. Nothing from the templates
is passed to eval().
"""

import ast
import json
import math
import random
import re
import sys
from pathlib import Path

NAMES_MALE = ["Tunde", "Mateo", "Arjun", "Kofi", "Lukas", "Hiro", "Omar", "Diego", "Ivan", "Samuel", "Chen", "Ade"]
NAMES_FEMALE = ["Amara", "Sofia", "Priya", "Yuki", "Fatima", "Elena", "Zainab", "Chloe", "Lina", "Ngozi", "Mei", "Ana"]
LISTS = {
    "names_male": NAMES_MALE,
    "names_female": NAMES_FEMALE,
    "names": NAMES_MALE + NAMES_FEMALE,
    "currencies_sym": ["$", "€", "£"],
    "fruits": ["apples", "pears", "mangoes", "oranges", "plums"],
    "colors": ["red", "blue", "green", "yellow", "purple", "white"],
    "sports": ["football", "basketball", "tennis", "volleyball"],
    "weekdays": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
}

# Templates that need lists or float helpers we have not mapped are skipped
# and counted, rather than guessed at.
UNSUPPORTED = re.compile(r"fraction_|multi_times|multiple_ice|weights_|np\.|frange|fix_floats|numbers_within|shuffle_list|sample_sequential")

SLOT = re.compile(r"\{(\w+),([^{}]+)\}")


class Unsupported(Exception):
    pass


def is_int(x):
    return abs(x - round(x)) < 1e-9


def divides(a, b):
    return b != 0 and is_int(a / b)


FUNCS = {"is_int": is_int, "divides": divides, "int": int, "round": round, "abs": abs, "min": min, "max": max, "float": float}
BINOPS = {
    ast.Add: lambda a, b: a + b, ast.Sub: lambda a, b: a - b, ast.Mult: lambda a, b: a * b,
    ast.Div: lambda a, b: a / b, ast.FloorDiv: lambda a, b: a // b, ast.Mod: lambda a, b: a % b,
    ast.Pow: lambda a, b: a ** b,
}
CMPS = {
    ast.Lt: lambda a, b: a < b, ast.LtE: lambda a, b: a <= b, ast.Gt: lambda a, b: a > b,
    ast.GtE: lambda a, b: a >= b, ast.Eq: lambda a, b: a == b, ast.NotEq: lambda a, b: a != b,
}


def ev(node, env):
    if isinstance(node, ast.Expression):
        return ev(node.body, env)
    if isinstance(node, ast.Constant) and isinstance(node.value, (int, float, str)):
        return node.value
    if isinstance(node, ast.Name):
        if node.id in env:
            return env[node.id]
        raise Unsupported(f"unknown name {node.id}")
    if isinstance(node, ast.BinOp) and type(node.op) in BINOPS:
        return BINOPS[type(node.op)](ev(node.left, env), ev(node.right, env))
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.USub):
        return -ev(node.operand, env)
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.Not):
        return not ev(node.operand, env)
    if isinstance(node, ast.BoolOp):
        vals = [ev(v, env) for v in node.values]
        return all(vals) if isinstance(node.op, ast.And) else any(vals)
    if isinstance(node, ast.Compare):
        left = ev(node.left, env)
        for op, comp in zip(node.ops, node.comparators):
            if type(op) not in CMPS:
                raise Unsupported("comparison")
            right = ev(comp, env)
            if not CMPS[type(op)](left, right):
                return False
            left = right
        return True
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in FUNCS:
        return FUNCS[node.func.id](*[ev(a, env) for a in node.args])
    if isinstance(node, (ast.List, ast.Tuple)):
        return [ev(e, env) for e in node.elts]
    raise Unsupported(ast.dump(node)[:60])


def expr(src, env):
    return ev(ast.parse(src.strip(), mode="eval"), env)


def digits(x):
    return len(str(abs(int(x)))) if x == int(x) else None


def parse_template(t):
    qa = t["question_annotated"]
    body, _, rest = qa.partition("#init:")
    init, _, rest = rest.partition("#conditions:")
    if "#answer:" in init:
        init, _, answer = init.partition("#answer:")
        conds = ""
    else:
        conds, _, answer = rest.partition("#answer:")
    if UNSUPPORTED.search(init) or UNSUPPORTED.search(conds):
        raise Unsupported("helper not mapped")

    defaults = {m.group(1): m.group(2) for m in SLOT.finditer(body)}
    numeric, choice = {}, {}
    for line in init.strip().splitlines():
        line = line.strip().lstrip("-").strip()
        if not line:
            continue
        m = re.match(r"\$?([\w ,$]+?)\s*=\s*(.+)$", line)
        if not m:
            raise Unsupported(f"init line {line}")
        names = [n.strip().lstrip("$") for n in m.group(1).split(",")]
        rhs = m.group(2).strip()
        r = re.fullmatch(r"range\(([^)]*)\)", rhs)
        s = re.fullmatch(r"sample\((.+?)(?:,\s*(\d+))?\)", rhs)
        if r and len(names) == 1:
            args = [int(expr(a, {})) for a in r.group(1).split(",")]
            numeric[names[0]] = list(range(*args))
        elif s:
            src, k = s.group(1).strip(), int(s.group(2) or 1)
            pool = LISTS[src] if src in LISTS else expr(src, {})
            if not isinstance(pool, list):
                raise Unsupported("sample source")
            if len(names) != k and not (k == 1 and len(names) == 1):
                raise Unsupported("sample arity")
            choice[tuple(names)] = pool
        else:
            raise Unsupported(f"init {rhs[:30]}")
    cond_lines = [c.strip().lstrip("-").strip() for c in conds.strip().splitlines() if c.strip()]
    return body.strip(), defaults, numeric, choice, cond_lines, answer.strip()


def make_twin(t, rng, tries=4000):
    body, defaults, numeric, choice, conds, answer = parse_template(t)
    # Matched sizes: a numeric slot may only take values with as many digits
    # as the number printed in the original question.
    pools = {}
    for name, values in numeric.items():
        d = defaults.get(name)
        try:
            dv = float(d)
        except (TypeError, ValueError):
            pools[name] = values
            continue
        if dv != int(dv):
            raise Unsupported("float default")
        want = digits(dv)
        matched = [v for v in values if digits(v) == want and v != int(dv)]
        if not matched:
            raise Unsupported(f"no same-size values for {name}")
        pools[name] = matched

    for _ in range(tries):
        env = {}
        for names, pool in choice.items():
            picks = rng.sample(pool, len(names)) if len(names) > 1 else [rng.choice(pool)]
            env.update(dict(zip(names, picks)))
        for name, pool in pools.items():
            env[name] = rng.choice(pool)
        try:
            if all(expr(c, env) for c in conds):
                ans = expr(answer, env)
                if not is_int(ans) or ans < 0:
                    continue
                text = SLOT.sub(lambda m: fmt(env.get(m.group(1), m.group(2))), body)
                return text, int(round(ans))
        except ZeroDivisionError:
            continue
        except (TypeError, ValueError, SyntaxError) as e:
            raise Unsupported(f"expression {type(e).__name__}")
    raise Unsupported("conditions never satisfied with same-size numbers")


def fmt(v):
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v)


def original_answer(t):
    return float(t["answer"].split("####")[-1].strip().replace(",", ""))


def main(template_dir, out_path, seed=None):
    # A fixed seed would let anyone regenerate the twins from this file, so
    # by default the seed comes from the OS and is never written down.
    rng = random.Random(seed) if seed is not None else random.SystemRandom()
    kept, skipped = [], {}
    for f in sorted(Path(template_dir).glob("*.json")):
        t = json.loads(f.read_text())
        try:
            twin_q, twin_a = make_twin(t, rng)
        except Unsupported as e:
            key = str(e).split(" for ")[0][:40]
            skipped[key] = skipped.get(key, 0) + 1
            continue
        kept.append({
            "template": f.stem,
            "original": {"prompt": t["question"], "value": original_answer(t)},
            "twin": {"prompt": twin_q, "value": float(twin_a)},
        })
    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w") as fh:
        for row in kept:
            fh.write(json.dumps(row) + "\n")
    print(f"kept {len(kept)} templates, skipped {sum(skipped.values())}")
    for k, v in sorted(skipped.items(), key=lambda kv: -kv[1]):
        print(f"  {v:3d}  {k}")


if __name__ == "__main__":
    seed = int(sys.argv[3]) if len(sys.argv) > 3 else None
    main(sys.argv[1], sys.argv[2], seed)
