// Shared dashboard helpers: Supabase client and owner login.
// Needs config.js (window.SUPABASE_CONFIG) and supabase-js loaded first.
(function () {
  const cfg = window.SUPABASE_CONFIG;
  const sb = cfg ? window.supabase.createClient(cfg.url, cfg.key) : null;

  function loginCard(target, message) {
    target.innerHTML = `
      <section class="card login">
        <h2>로그인</h2>
        <p class="muted">이 대시보드는 소유자만 볼 수 있습니다. Supabase에 만들어 둔 계정으로 로그인하세요.</p>
        <form id="login-form" class="form login-form">
          <label>이메일<input name="email" type="email" autocomplete="username" required></label>
          <label>비밀번호<input name="password" type="password" autocomplete="current-password" required></label>
          <div class="actions wide"><button type="submit">로그인</button><span id="login-msg" class="muted">${message || ""}</span></div>
        </form>
      </section>`;
  }

  // Resolves with the session; shows a login form in `target` until the owner signs in.
  async function requireLogin(target) {
    if (!sb) {
      target.innerHTML = `<section class="card"><p class="muted">docs/config.js가 없습니다. PC에서 scripts/write-site-config.ps1을 실행해 주세요.</p></section>`;
      throw new Error("missing config.js");
    }
    const { data } = await sb.auth.getSession();
    if (data.session) return data.session;
    const original = target.innerHTML;
    loginCard(target);
    return new Promise((resolve) => {
      target.querySelector("#login-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const f = e.target.elements;
        const msg = target.querySelector("#login-msg");
        msg.textContent = "확인 중…";
        const { data, error } = await sb.auth.signInWithPassword({ email: f.email.value.trim(), password: f.password.value });
        if (error) { msg.textContent = "로그인 실패: 이메일이나 비밀번호를 확인하세요."; return; }
        target.innerHTML = original;
        resolve(data.session);
      });
    });
  }

  async function logout() { await sb?.auth.signOut(); location.reload(); }

  window.wwa = { sb, requireLogin, logout };
})();
