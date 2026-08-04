// Reusable AI Chat Dialog Component
(function(root,factory){
  if(typeof module!=='undefined'&&module.exports){module.exports=factory();}
  else{root.ChatDialog=factory();}
})(typeof self!=='undefined'?self:this,function(){
  function esc(s){if(!s)return'';const d=document.createElement('div');d.textContent=String(s);return d.innerHTML;}

  function create(container,opts){
    const o=opts||{};
    let msgs=o.messages||[];
    let loading=false;
    let stage=o.stage||1;
    let totalStages=o.totalStages||4;

    function render(){
      let stageHtml='<div class="stage-progress" style="display:flex;align-items:center;justify-content:center;gap:6px;padding:10px 0">';
      for(let i=1;i<=totalStages;i++){
        if(i>1)stageHtml+='<div style="width:20px;height:2px;background:'+(i<=stage?'var(--color-success)':'var(--color-border)')+'"></div>';
        const cls=i<stage?'done':i===stage?'active':'';
        stageHtml+='<div style="width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;border:2px solid '+(cls==='done'?'var(--color-success)':cls==='active'?'var(--color-primary)':'var(--color-border)')+';color:'+(cls==='done'?'var(--color-success)':cls==='active'?'var(--color-primary)':'var(--color-text-tertiary)')+';background:'+(cls==='done'?'var(--color-success-light)':cls==='active'?'var(--color-primary-light)':'#fff')+'">'+(i<stage?'✓':i)+'</div>';
      }
      stageHtml+='</div>';

      let msgsHtml='';
      msgs.forEach((m)=>{
        if(m.role==='ai'){
          msgsHtml+='<div class="chat-msg ai" style="display:flex;gap:8px;max-width:85%;align-self:flex-start;margin-bottom:12px"><div style="width:32px;height:32px;border-radius:50%;background:var(--color-bg-hover);display:flex;align-items:center;justify-content:center;flex-shrink:0">🤖</div><div style="padding:10px 14px;border-radius:12px;border-bottom-left-radius:4px;font-size:14px;line-height:1.6;background:#fff;border:1px solid var(--color-border)">'+(m.html||esc(m.content||''))+'</div></div>';
        }else{
          msgsHtml+='<div class="chat-msg user" style="display:flex;gap:8px;max-width:85%;align-self:flex-end;flex-direction:row-reverse;margin-bottom:12px"><div style="width:32px;height:32px;border-radius:50%;background:var(--color-primary);color:#fff;display:flex;align-items:center;justify-content:center;flex-shrink:0">👤</div><div style="padding:10px 14px;border-radius:12px;border-bottom-right-radius:4px;font-size:14px;line-height:1.6;background:var(--color-primary);color:#fff">'+esc(m.content||'')+'</div></div>';
        }
      });
      if(loading){
        msgsHtml+='<div class="chat-msg ai" style="display:flex;gap:8px;max-width:85%;margin-bottom:12px"><div style="width:32px;height:32px;border-radius:50%;background:var(--color-bg-hover);display:flex;align-items:center;justify-content:center">🤖</div><div style="padding:10px 14px;border-radius:12px;background:#fff;border:1px solid var(--color-border)"><div class="spinner"></div></div></div>';
      }

      let actionsHtml='';
      if(o.actions&&o.actions.length){
        actionsHtml='<div style="display:flex;gap:8px;flex-wrap:wrap">'+o.actions.map((a)=>'<button class="btn '+(a.cls||'btn-outline')+' btn-sm" data-action="'+a.id+'">'+esc(a.label)+'</button>').join('')+'</div>';
      }

      container.innerHTML='<div style="display:flex;flex-direction:column;height:calc(100dvh - 100px)">'
        +stageHtml
        +'<div style="flex:1;overflow-y:auto;padding:10px;display:flex;flex-direction:column" id="chat-msgs">'+msgsHtml+'</div>'
        +'<div style="padding:10px;background:#fff;border-top:1px solid var(--color-border);display:flex;gap:8px;align-items:center" id="chat-input-area">'
        +(o.showInput!==false?'<input style="flex:1;height:40px;padding:0 12px;border:1px solid var(--color-border);border-radius:20px;font-size:14px" id="chat-input" type="text" placeholder="'+esc(o.placeholder||'输入微调指令...')+'" autocomplete="off"><button class="btn btn-primary btn-sm" id="chat-send">发送</button>':'')
        +actionsHtml+'</div></div>';

      const msgEl=container.querySelector('#chat-msgs');
      if(msgEl)msgEl.scrollTop=msgEl.scrollHeight;

      const input=container.querySelector('#chat-input');
      const sendBtn=container.querySelector('#chat-send');
      const doSend=()=>{
        if(!input)return;
        const text=input.value.trim();
        if(!text)return;
        input.value='';input.disabled=true;if(sendBtn)sendBtn.disabled=true;
        if(o.onSend)o.onSend(text,()=>{input.disabled=false;if(sendBtn)sendBtn.disabled=false;input.focus();});
      };
      if(input)input.addEventListener('keydown',(e)=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();doSend();}});
      if(sendBtn)sendBtn.addEventListener('click',doSend);
      container.querySelectorAll('[data-action]').forEach((btn)=>{
        btn.addEventListener('click',()=>{if(o.onAction)o.onAction(btn.dataset.action);});
      });
    }

    return {
      render,
      addMessage(msg){
        msgs.push(msg);
        const el=container.querySelector('#chat-msgs');
        if(el){
          const d=document.createElement('div');
          if(msg.role==='ai'){
            d.style.cssText='display:flex;gap:8px;max-width:85%;align-self:flex-start;margin-bottom:12px';
            d.innerHTML='<div style="width:32px;height:32px;border-radius:50%;background:var(--color-bg-hover);display:flex;align-items:center;justify-content:center;flex-shrink:0">🤖</div><div style="padding:10px 14px;border-radius:12px;border-bottom-left-radius:4px;font-size:14px;line-height:1.6;background:#fff;border:1px solid var(--color-border)">'+(msg.html||esc(msg.content||''))+'</div>';
          }else{
            d.style.cssText='display:flex;gap:8px;max-width:85%;align-self:flex-end;flex-direction:row-reverse;margin-bottom:12px';
            d.innerHTML='<div style="width:32px;height:32px;border-radius:50%;background:var(--color-primary);color:#fff;display:flex;align-items:center;justify-content:center;flex-shrink:0">👤</div><div style="padding:10px 14px;border-radius:12px;border-bottom-right-radius:4px;font-size:14px;line-height:1.6;background:var(--color-primary);color:#fff">'+esc(msg.content||'')+'</div>';
          }
          el.appendChild(d);el.scrollTop=el.scrollHeight;
        }
      },
      setLoading(show){loading=show;render();},
      setStage(s){stage=s;render();},
      setActions(actions){o.actions=actions;render();},
      destroy(){container.innerHTML='';}
    };
  }
  return{create};
});