import { api, icon, esc, toast } from '../ui.js';

const DEMO = [
  ['admin@hr360.sa', 'Admin@123', 'بسام البليهي', 'مدير النظام'],
  ['hr@hr360.sa', 'Hr@12345', 'سارة الأحمدي', 'موارد بشرية'],
  ['viewer@hr360.sa', 'View@1234', 'فهد المالكي', 'اطلاع فقط'],
];

export function renderLogin(root, onSuccess) {
  root.innerHTML = `
    <div class="login">
      <aside class="login__aside">
        <div class="login__brand">
          <span class="login__brand-mark">
            <svg viewBox="0 0 44 44" width="32" height="32"><defs><linearGradient id="lgL" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#fff" stop-opacity="0.9"/><stop offset="100%" stop-color="#fff" stop-opacity="0.6"/></linearGradient></defs><polygon points="22,2 40,12 40,32 22,42 4,32 4,12" fill="url(#lgL)"/><text x="22" y="28" text-anchor="middle" font-size="18" font-weight="600" fill="#534feb" font-family="var(--font),sans-serif">H</text></svg>
          </span>
          HR Core
        </div>

        <div class="login__pitch">
          <h2>إدارة فريقك،<br />من مكان واحد.</h2>
          <p>
            تابع بيانات الموظفين والحضور والرواتب في نظام واحد مترابط،
            بدل جداول متفرقة يصعب تتبعها.
          </p>
        </div>

        <div class="login__stats">
          <div class="login__stat">
            <b><span class="ltr">12</span></b>
            <span>موظف مُسجّل</span>
          </div>
          <div class="login__stat">
            <b><span class="ltr">120</span></b>
            <span>سجل حضور</span>
          </div>
          <div class="login__stat">
            <b><span class="ltr">6</span></b>
            <span>أقسام</span>
          </div>
        </div>
      </aside>

      <main class="login__panel">
        <form class="login__form" id="loginForm" novalidate>
          <h1>تسجيل الدخول</h1>
          <p>ادخل إلى لوحة تحكم الموارد البشرية.</p>

          <div class="login__fields">
            <div class="form-row">
              <label class="label" for="email">البريد الإلكتروني</label>
              <input class="input" id="email" name="email" type="email"
                     dir="ltr" autocomplete="username"
                     placeholder="admin@hr360.sa" required />
            </div>

            <div class="form-row">
              <label class="label" for="password">كلمة المرور</label>
              <input class="input" id="password" name="password" type="password"
                     dir="ltr" autocomplete="current-password"
                     placeholder="••••••••" required />
            </div>

            <div class="form-error" id="loginError" hidden></div>

            <button class="btn btn--primary" type="submit" id="submitBtn"
                    style="width:100%;padding:15px">
              دخول
            </button>
          </div>

          <div class="demo-accounts">
            <div class="demo-accounts__title">حسابات تجريبية — اضغط للتعبئة</div>
            ${DEMO.map(
              ([email, , name, role]) => `
              <button type="button" class="demo-account" data-email="${esc(email)}">
                ${icon('user-round', 17)}
                <span>
                  <span style="display:block">${esc(name)}</span>
                  <span class="ltr" style="font-size:12px;color:var(--text-60)">${esc(email)}</span>
                </span>
                <span class="demo-account__role">${esc(role)}</span>
              </button>`
            ).join('')}
          </div>
        </form>
      </main>
    </div>`;

  const form = root.querySelector('#loginForm');
  const errorBox = root.querySelector('#loginError');
  const submitBtn = root.querySelector('#submitBtn');
  // Looked up by id rather than through the form's named-property access, which
  // is not implemented consistently outside real browsers and left these fields
  // undefined under the jsdom test harness.
  const emailInput = root.querySelector('#email');
  const passwordInput = root.querySelector('#password');

  root.querySelectorAll('.demo-account').forEach((btn) => {
    btn.addEventListener('click', () => {
      const email = btn.dataset.email;
      const match = DEMO.find((d) => d[0] === email);
      emailInput.value = email;
      passwordInput.value = match[1];
      errorBox.hidden = true;
      passwordInput.focus();
    });
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorBox.hidden = true;

    const email = emailInput.value.trim();
    const password = passwordInput.value;

    if (!email || !password) {
      errorBox.textContent = 'أدخل البريد الإلكتروني وكلمة المرور.';
      errorBox.hidden = false;
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'جارٍ الدخول…';

    try {
      const { user } = await api.login(email, password);
      toast(`أهلًا ${user.name}`, 'success');
      onSuccess(user);
    } catch (err) {
      errorBox.textContent = err.message;
      errorBox.hidden = false;
      passwordInput.select();
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'دخول';
    }
  });

  emailInput.focus();
}
