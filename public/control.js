(function () {
  const tokenEl = document.getElementById("token");
  const toastEl = document.getElementById("toast");

  tokenEl.value = localStorage.getItem("gacha_admin_token") || "";
  tokenEl.addEventListener("input", () => {
    localStorage.setItem("gacha_admin_token", tokenEl.value);
  });

  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    setTimeout(() => toastEl.classList.remove("show"), 1400);
  }

  async function post(path, body) {
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, token: tokenEl.value })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast(err.error || `Error ${res.status}`);
        return null;
      }
      toast("Sent ✓");
      return res.json();
    } catch (e) {
      toast("Network error");
      return null;
    }
  }

  document.querySelectorAll("[data-coins]").forEach(btn => {
    btn.addEventListener("click", () => {
      const name = document.getElementById("giftName").value.trim() || "Viewer";
      const coins = Number(btn.dataset.coins);
      post("/api/gift", { name, coins, giftName: btn.textContent.trim() });
    });
  });

  document.getElementById("btnComment").addEventListener("click", () => {
    const name = document.getElementById("chatName").value.trim() || "Viewer";
    const comment = document.getElementById("chatText").value.trim() || "...";
    post("/api/comment", { name, comment });
  });

  document.getElementById("btnLike").addEventListener("click", () => {
    const name = document.getElementById("chatName").value.trim() || "Viewer";
    post("/api/like", { name, count: 10 });
  });

  document.getElementById("btnReset").addEventListener("click", () => {
    if (!confirm("Reset the whole season? This clears all players and points.")) return;
    post("/api/reset", {});
  });
})();
