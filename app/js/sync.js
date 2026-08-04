// WebDAV Cloud Sync Module
(function(root,factory){
  if(typeof module!=='undefined'&&module.exports){module.exports=factory();}
  else{root.Sync=factory();}
})(typeof self!=='undefined'?self:this,function(){
  const SYNC_PATH='ai-learn-sync';
  const MANIFEST_FILE='manifest.json';
  const DATA_FILE='sync-data.json';

  async function webdavReq(method,path,body,config){
    const base=String(config.url||'').replace(/\/+$/,'');
    const url=base+'/'+path;
    const headers={};
    if(config.username&&config.password){
      headers['Authorization']='Basic '+btoa(config.username+':'+config.password);
    }
    if(body){headers['Content-Type']='application/json; charset=utf-8';}
    const res=await fetch(url,{method,headers,body:body?JSON.stringify(body,null,2):undefined});
    return res;
  }

  function create(core){
    async function getConfig(){
      try{
        const db=typeof LocalDB!=='undefined'?LocalDB:null;
        if(!db)return null;
        const row=await db.get('settings','sync_config');
        if(!row)return null;
        let pw='';
        if(row.password_encrypted&&core.decryptSecret){pw=await core.decryptSecret(row.password_encrypted);}
        return{url:row.url||'',username:row.username||'',password:pw,
          autoSyncMinutes:row.auto_sync_minutes||0,deviceName:row.device_name||'',deviceId:row.device_id||''};
      }catch(e){return null;}
    }

    async function saveConfig(config){
      const db=typeof LocalDB!=='undefined'?LocalDB:null;
      if(!db)return;
      let pwEnc='';
      if(config.password&&core.encryptSecret){pwEnc=await core.encryptSecret(config.password);}
      const did=config.deviceId||('dev-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8));
      try{localStorage.setItem('ai-learn-device-id',did);}catch(e){}
      await db.put('settings',{id:'sync_config',url:config.url||'',username:config.username||'',
        password_encrypted:pwEnc,auto_sync_minutes:config.autoSyncMinutes||0,
        device_name:config.deviceName||'',device_id:did,updated_at:new Date().toISOString()});
    }

    async function testConnection(url,username,password){
      try{
        const res=await webdavReq('PROPFIND','',null,{url,username,password});
        if(res.ok)return{ok:true,message:'连接成功'};
        if(res.status===401)return{ok:false,message:'认证失败'};
        if(res.status===404)return{ok:false,message:'路径不存在'};
        return{ok:false,message:'HTTP '+res.status};
      }catch(e){return{ok:false,message:e.message};}
    }

    async function ensureDir(config){
      try{
        let res=await webdavReq('PROPFIND',SYNC_PATH,null,config);
        if(res.status===404){await webdavReq('MKCOL',SYNC_PATH,null,config);}
        return true;
      }catch(e){return false;}
    }

    async function push(onProgress){
      const config=await getConfig();
      if(!config||!config.url)throw new Error('请先配置云同步');
      await ensureDir(config);
      const exportData=await core.collectExportData();
      const payload={format_version:1,device_id:config.deviceId,device_name:config.deviceName||'',
        pushed_at:new Date().toISOString(),data:exportData};
      const res=await webdavReq('PUT',SYNC_PATH+'/'+DATA_FILE,payload,config);
      if(!res.ok)throw new Error('上传失败 HTTP '+res.status);
      const manifest={format_version:1,last_sync_version:Date.now(),
        last_sync_at:new Date().toISOString(),last_device_id:config.deviceId};
      await webdavReq('PUT',SYNC_PATH+'/'+MANIFEST_FILE,manifest,config);
      if(onProgress)onProgress('done','上传完成');
      return{ok:true};
    }

    async function pull(onProgress){
      const config=await getConfig();
      if(!config||!config.url)throw new Error('请先配置云同步');
      const res=await webdavReq('GET',SYNC_PATH+'/'+DATA_FILE,null,config);
      if(res.status===404)throw new Error('云端没有同步数据');
      if(!res.ok)throw new Error('下载失败 HTTP '+res.status);
      const payload=await res.json();
      if(!payload.data)throw new Error('云端数据无效');
      const result=await core.importData(payload.data,{},{conflictMode:'overwrite',preserveProgress:true});
      if(onProgress)onProgress('done','导入完成');
      return{ok:true,...result,fromDevice:payload.device_name||''};
    }

    async function sync(onProgress){
      await push(onProgress);
      return await pull(onProgress);
    }

    let autoTimer=null;

    async function enableAutoSync(minutes){
      if(autoTimer){clearInterval(autoTimer);autoTimer=null;}
      if(minutes>0){
        autoTimer=setInterval(()=>{sync().catch(()=>{});},minutes*60000);
      }
    }

    async function getSyncStatus(){
      const config=await getConfig();
      if(!config||!config.url)return{configured:false};
      let remote=null;
      try{
        const res=await webdavReq('GET',SYNC_PATH+'/'+MANIFEST_FILE,null,config);
        if(res.ok)remote=await res.json();
      }catch(e){}
      return{configured:true,status:remote?'connected':'no-remote',
        remoteDevice:remote?remote.last_device_name:null,
        remoteTime:remote?remote.last_sync_at:null,
        autoSync:!!(config.autoSyncMinutes>0)};
    }

    return{getConfig,saveConfig,testConnection,push,pull,sync,enableAutoSync,getSyncStatus};
  }

  return{create};
});