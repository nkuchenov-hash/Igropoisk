(()=>{
  'use strict';

  const form=document.getElementById('loginForm');
  const username=document.getElementById('loginUsername');
  const password=document.getElementById('loginPassword');
  const remember=document.getElementById('loginRemember');
  const error=document.getElementById('loginError');
  const submit=document.getElementById('loginSubmit');
  const toggle=document.getElementById('passwordToggle');
  const auth=window.IgropoiskAuth;

  if(!form||!auth)return;

  const current=auth.session();
  const params=new URLSearchParams(location.search);
  const returnTo=auth.safeReturn(params.get('return'));
  if(current)location.replace(returnTo);

  toggle?.addEventListener('click',()=>{
    const visible=password.type==='text';
    password.type=visible?'password':'text';
    toggle.textContent=visible?'Показать':'Скрыть';
    toggle.setAttribute('aria-label',visible?'Показать пароль':'Скрыть пароль');
  });

  form.addEventListener('submit',async event=>{
    event.preventDefault();
    error.textContent='';
    submit.disabled=true;
    submit.textContent='Входим…';
    const result=await auth.login(username.value,password.value,remember.checked);
    if(result.ok){
      location.replace(returnTo);
      return;
    }
    error.textContent=result.error;
    password.select();
    submit.disabled=false;
    submit.textContent='Войти';
  });
})();
