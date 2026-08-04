// TTL cache for high-frequency reads
(function(root,factory){
  if(typeof module!=='undefined'&&module.exports){module.exports=factory();}
  else{root.LocalCache=factory();}
})(typeof self!=='undefined'?self:this,function(){
  function create(){
    const store=new Map();
    return {
      get(key){
        const e=store.get(key);
        if(!e)return null;
        if(Date.now()>e.expires){store.delete(key);return null;}
        return e.value;
      },
      set(key,value,ttlMs){
        store.set(key,{value,expires:Date.now()+(typeof ttlMs==='number'?ttlMs:30000)});
      },
      delete(key){store.delete(key);},
      invalidatePrefix(prefix){
        for(const key of store.keys()){if(String(key).startsWith(prefix))store.delete(key);}
      },
      clear(){store.clear();}
    };
  }
  return {create};
});