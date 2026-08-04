(()=>{
  'use strict';
  const auth=window.IgropoiskAuth;
  const session=auth?.requireAuth({role:'admin',returnTo:location.href});
  if(!session)return;
  const name=document.getElementById('adminName');
  if(name)name.textContent=session.user.displayName;
  document.getElementById('adminLogout')?.addEventListener('click',()=>{
    auth.logout();
    location.replace(auth.destination(''));
  });
})();
