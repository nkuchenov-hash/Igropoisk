(()=>{
  'use strict';
  const auth=window.IgropoiskAuth;
  const session=auth?.requireAuth({returnTo:location.href});
  if(!session)return;

  const setText=(id,value)=>{const node=document.getElementById(id);if(node)node.textContent=String(value)};
  setText('accountName',session.user.displayName);
  setText('accountAvatar',session.user.displayName.slice(0,1).toUpperCase());
  setText('accountRole',session.user.roleLabel);
  setText('accountGreeting',session.user.email||`@${session.user.username}`);
  setText('accountCreated',new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'long',year:'numeric'}).format(new Date(session.user.createdAt||Date.now())));

  const stats=auth.stats(session);
  Object.entries(stats).forEach(([key,value])=>setText(`stat-${key}`,value));
  setText('stat-playing-copy',stats.playing);
  setText('stat-completed-copy',stats.completed);

  const data=auth.getUserData(session);
  const recent=document.getElementById('accountRecent');
  if(recent&&Array.isArray(data?.recent)&&data.recent.length){
    recent.innerHTML='';
    data.recent.slice(0,6).forEach(item=>{
      const row=document.createElement('div');
      row.className='account-activity-row';
      const title=document.createElement('strong');
      title.textContent=item.title||'Игра';
      const meta=document.createElement('span');
      meta.textContent=item.action||'Просмотрено';
      row.append(title,meta);
      recent.appendChild(row);
    });
  }

  const adminEntry=document.getElementById('adminEntry');
  if(adminEntry)adminEntry.hidden=session.user.role!=='admin';

  document.querySelectorAll('[data-account-tab]').forEach(button=>{
    button.addEventListener('click',()=>{
      const id=button.dataset.accountTab;
      document.querySelectorAll('[data-account-tab]').forEach(item=>item.classList.toggle('active',item===button));
      document.querySelectorAll('[data-account-panel]').forEach(panel=>panel.hidden=panel.dataset.accountPanel!==id);
    });
  });

  document.getElementById('accountLogout')?.addEventListener('click',()=>{
    auth.logout();
    location.replace(auth.destination(''));
  });
})();
