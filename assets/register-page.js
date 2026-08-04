(()=>{
  'use strict';
  const auth=window.IgropoiskAuth;
  const form=document.getElementById('registerForm');
  if(!auth||!form)return;
  const username=document.getElementById('registerUsername');
  const email=document.getElementById('registerEmail');
  const password=document.getElementById('registerPassword');
  const confirm=document.getElementById('registerConfirm');
  const error=document.getElementById('registerError');
  const submit=document.getElementById('registerSubmit');
  const params=new URLSearchParams(location.search);
  const returnTo=auth.safeReturn(params.get('return'));
  if(auth.session())location.replace(returnTo);

  form.addEventListener('submit',async event=>{
    event.preventDefault();
    error.textContent='';
    if(password.value!==confirm.value){
      error.textContent='Пароли не совпадают.';
      confirm.select();
      return;
    }
    submit.disabled=true;
    submit.textContent='Создаём аккаунт…';
    const result=await auth.register({username:username.value,email:email.value,password:password.value});
    if(result.ok){location.replace(returnTo);return}
    error.textContent=result.error;
    submit.disabled=false;
    submit.textContent='Зарегистрироваться';
  });
})();
