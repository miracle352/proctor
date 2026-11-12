// Phones: the page links fold into a menu button instead of disappearing.
const header = document.querySelector(".nav"), links = header?.querySelector("nav");
if (header && links) {
  const btn = document.createElement("button");
  btn.type = "button"; btn.className = "menu-btn"; btn.setAttribute("aria-expanded", "false"); btn.setAttribute("aria-label", "Menu");
  btn.innerHTML = "<span></span><span></span>";
  links.id ||= "site-links"; btn.setAttribute("aria-controls", links.id);
  header.insertBefore(btn, links);
  const set = (open) => { header.classList.toggle("open", open); btn.setAttribute("aria-expanded", String(open)); };
  btn.addEventListener("click", () => set(!header.classList.contains("open")));
  links.addEventListener("click", (e) => { if (e.target.closest("a")) set(false); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") set(false); });
}
