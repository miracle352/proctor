// The hero is a rock face drawn by a fragment shader: layered noise for the
// stone, a raking light that follows the pointer, and seams that glow when
// a certificate lands. No image files.

const FRAG = `
#extension GL_OES_standard_derivatives : enable
precision highp float;
uniform vec2 uRes;
uniform float uT;
uniform vec2 uMouse;
uniform float uScroll;
uniform float uPulse;

float hash(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), u.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), u.x), u.y);
}
float fbm(vec2 p){
  float a = 0.5, s = 0.0;
  for(int i=0;i<5;i++){ s += a*noise(p); p = p*2.03 + vec2(17.1, 9.2); a *= 0.5; }
  return s;
}
float ridge(vec2 p){
  float a = 0.5, s = 0.0;
  for(int i=0;i<4;i++){ float n = 1.0 - abs(noise(p)*2.0-1.0); s += a*n*n; p = p*2.1 + vec2(3.7, 1.9); a *= 0.5; }
  return s;
}
vec2 warp(vec2 p){ return vec2(fbm(p + vec2(0.0, uT*0.012)), fbm(p + vec2(5.2, 1.3))); }

// Cracked stone: voronoi cells are the blocks, their borders the fractures.
// Returns (distance to nearest border, cell hash, tilt of this block).
vec4 blocks(vec2 x){
  vec2 n = floor(x), f = fract(x);
  vec2 mg, mr; float md = 8.0;
  for(int j=-1;j<=1;j++) for(int i=-1;i<=1;i++){
    vec2 g = vec2(float(i), float(j));
    vec2 o = vec2(hash(n+g), hash(n+g+31.7));
    vec2 r = g + o - f;
    float d = dot(r,r);
    if(d < md){ md = d; mr = r; mg = g; }
  }
  md = 8.0;
  for(int j=-2;j<=2;j++) for(int i=-2;i<=2;i++){
    vec2 g = mg + vec2(float(i), float(j));
    vec2 o = vec2(hash(n+g), hash(n+g+31.7));
    vec2 r = g + o - f;
    if(dot(mr-r, mr-r) > 0.00001) md = min(md, dot(0.5*(mr+r), normalize(r-mr)));
  }
  float id = hash(n + mg + 7.3);
  vec2 tilt = vec2(hash(n+mg+1.1), hash(n+mg+2.2)) - 0.5;
  return vec4(md, id, dot(tilt, -mr), 0.0);
}

void main(){
  vec2 uv = (gl_FragCoord.xy - 0.5*uRes) / uRes.y;
  vec2 p = uv*1.55 + vec2(uT*0.008, -uScroll*0.55);

  vec2 w = warp(p*0.6);
  vec2 q = p*1.1 + w*1.05 + 0.18*vec2(fbm(p*2.3), fbm(p*2.3+4.0));
  vec4 big = blocks(q);
  vec4 small = blocks(q*2.7 + 11.0);

  float grain = fbm(p*7.0 + w*2.0);
  float h = big.z*0.85 + small.z*0.16 + big.y*0.25
          + ridge(p*1.6 + w)*0.16 + grain*0.07
          + 0.012*sin(p.y*40.0 + w.x*10.0)
          - smoothstep(0.07, 0.0, big.x)*0.30
          - smoothstep(0.035, 0.0, small.x)*0.07;

  float k = uRes.y / 1.55;
  vec3 n = normalize(vec3(-dFdx(h)*k*0.9, -dFdy(h)*k*0.9, 1.0));

  vec2 m = (uMouse - 0.5*uRes) / uRes.y;
  vec3 L = normalize(vec3(m - uv, 0.38));
  float diff = max(dot(n, L), 0.0);
  float spec = pow(max(dot(reflect(-L, n), vec3(0,0,1)), 0.0), 26.0);

  vec3 basalt = vec3(0.070, 0.078, 0.070);
  vec3 slate  = vec3(0.300, 0.315, 0.292);
  vec3 chalk  = vec3(0.914, 0.894, 0.839);
  vec3 col = mix(basalt, slate, clamp(big.y*0.75 + grain*0.5, 0.0, 1.0));
  col = mix(col, chalk*0.42, smoothstep(0.80, 1.0, big.y)*0.55);
  col += chalk*0.06*smoothstep(0.88, 1.0, noise(p*46.0));
  col *= 0.16 + 1.25*diff;
  col += vec3(0.80,0.84,0.76)*spec*0.16;
  col *= 0.45 + 0.55*smoothstep(0.0, 0.05, big.x);

  // seams: some fractures carry light
  float mask = smoothstep(0.585, 0.70, fbm(q*0.30 + 9.0));
  float travel = 0.5 + 0.5*sin(uT*1.1 - (q.x*1.3+q.y)*2.2);
  float power = (0.45 + 0.55*travel) * (0.75 + uPulse*1.5);
  vec3 glow = vec3(0.78, 0.96, 0.24);
  float core = smoothstep(0.011, 0.0, big.x) * mask;
  float halo = smoothstep(0.12, 0.0, big.x) * mask;
  col = mix(col, glow, core*min(power*1.2, 1.0));
  col += glow*halo*0.22*power;
  col += glow*0.05*mask*power*diff;

  float left = smoothstep(0.35, -0.7, uv.x*uRes.y/uRes.x*2.0);
  col *= 1.0 - 0.74*left;
  col *= 1.0 - 0.5*smoothstep(0.30, 0.52, uv.y);
  col *= smoothstep(-0.66, -0.2, uv.y)*0.88 + 0.12;
  col *= 1.0 - 0.28*dot(uv, uv);

  gl_FragColor = vec4(pow(col, vec3(0.9)), 1.0);
}`;

const VERT = `attribute vec2 a; void main(){ gl_Position = vec4(a, 0.0, 1.0); }`;

export function mountRock(canvas) {
  const gl = canvas.getContext("webgl", { antialias: false, alpha: false, powerPreference: "high-performance" });
  if (!gl || !gl.getExtension("OES_standard_derivatives")) {
    canvas.classList.add("rock-fallback");
    return { pulse() {} };
  }
  const sh = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error("rock shader:", gl.getShaderInfoLog(s));
    return s;
  };
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, "a");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const U = (n) => gl.getUniformLocation(prog, n);
  const uRes = U("uRes"), uT = U("uT"), uMouse = U("uMouse"), uScroll = U("uScroll"), uPulse = U("uPulse");

  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  // The shader is the expensive thing on the page; render it below device
  // resolution and let CSS scale it. Stone hides the softness.
  const scale = Math.min(devicePixelRatio || 1, 1.25) * 0.75;
  let w = 0, h = 0, visible = true, pulse = 0;
  const mouse = { x: 0.72, y: 0.62, tx: 0.72, ty: 0.62 };

  const resize = () => {
    w = Math.max(2, Math.floor(canvas.clientWidth * scale));
    h = Math.max(2, Math.floor(canvas.clientHeight * scale));
    canvas.width = w;
    canvas.height = h;
    gl.viewport(0, 0, w, h);
  };
  new ResizeObserver(resize).observe(canvas);
  resize();

  addEventListener("pointermove", (e) => {
    const r = canvas.getBoundingClientRect();
    mouse.tx = (e.clientX - r.left) / r.width;
    mouse.ty = 1 - (e.clientY - r.top) / r.height;
  }, { passive: true });
  new IntersectionObserver(([en]) => { visible = en.isIntersecting; }).observe(canvas);

  const t0 = performance.now();
  const frame = (now) => {
    if (visible) {
      mouse.x += (mouse.tx - mouse.x) * 0.06;
      mouse.y += (mouse.ty - mouse.y) * 0.06;
      pulse *= 0.965;
      gl.uniform2f(uRes, w, h);
      gl.uniform1f(uT, still ? 12.0 : (now - t0) / 1000);
      gl.uniform2f(uMouse, mouse.x * w, mouse.y * h);
      gl.uniform1f(uScroll, Math.min(scrollY / innerHeight, 1.5));
      gl.uniform1f(uPulse, pulse);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    if (!still) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  if (still) addEventListener("resize", () => requestAnimationFrame(frame));

  return { pulse() { pulse = 1; if (still) requestAnimationFrame(frame); } };
}
