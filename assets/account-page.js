(()=>{
  'use strict';

  const auth=window.IgropoiskAuth;
  const session=auth?.requireAuth({returnTo:location.href});
  if(!session)return;

  const name=document.getElementById('accountName');
  const avatar=document.getElementById('accountAvatar');
  const role=document.getElementById('accountRole');
  const greeting=document.getElementById('accountGreeting');
  const adminPanel=document.getElementById('adminPanel');
  const logout=document.getElementById('accountLogout');

  if(name)name.textContent=session.user.displayName;
  if(avatar)avatar.textContent=session.user.displayName.slice(0,1).toUpperCase();
  if(role)role.textContent=session.user.roleLabel;
  if(greeting)greeting.textContent=`Аккаунт ${session.user.displayName}`;
  if(adminPanel)adminPanel.hidden=session.user.role!=='admin';

  document.querySelectorAll('[data-account-tab]').forEach(button=>{
    button.addEventListener('click',()=>{
      const id=button.dataset.accountTab;
      document.querySelectorAll('[data-account-tab]').forEach(item=>item.classList.toggle('active',item===button));
      document.querySelectorAll('[data-account-panel]').forEach(panel=>panel.hidden=panel.dataset.accountPanel!==id);
    });
  });

  logout?.addEventListener('click',()=>{
    auth.logout();
    location.replace(auth.destination(''));
  });
})();
