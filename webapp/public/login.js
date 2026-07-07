const form = document.getElementById('login-form');
const errorEl = document.getElementById('login-error');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorEl.style.display = 'none';
  const id = document.getElementById('login-id').value.trim();
  const password = document.getElementById('login-password').value;
  const btn = document.getElementById('login-submit');
  btn.disabled = true;
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, password }),
    });
    const data = await res.json();
    if (!data.ok) {
      errorEl.textContent = data.error || '로그인에 실패했습니다.';
      errorEl.style.display = 'block';
      return;
    }
    location.href = '/';
  } catch (err) {
    errorEl.textContent = '로그인 요청 중 오류가 발생했습니다: ' + err.message;
    errorEl.style.display = 'block';
  } finally {
    btn.disabled = false;
  }
});
