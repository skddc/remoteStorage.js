//this is the base module. it is the basis for specific modules, and deals with coordinating the cache, events from other tabs, and all wire traffic with the cloud

//baseModule:
//- get, setObject(path, type, fields), setField(path, value), setMedia(path, mimeType, data), remove
//- getHint(path)
//- setModuleContext(context)

define(['./session'], function (session) {
  function create(moduleName, syncInterval) {
    var handlers = { change: []},
      prefix = 'remote_storage_cache:',
      now = new Date().getTime(),
      memCache = {};
    function fire(eventName, eventObj) {
      if(handlers[eventName]) {
        for(var i=0; i<handlers[eventName].length; i++) {
          handlers[eventName][i](eventObj);
        }
      }
    }
    function forThisModule(e) {
      return (e && e.path && typeof(e.path) == 'string' && (
        e.path.substring(0, moduleName.length+1) == moduleName+'/'
        ||e.path.substring(0, 'public/'.length+moduleName.length+1) == 'public/'+moduleName+'/'
      ));
    }
    window.addEventListener('storage', function(e) {
      if(e.key.substring(0, prefix.length == prefix)) {
        e.path = e.key.substring(prefix.length);
        e.origin='device';
      }
      if(forThisModule(e)) {
        fire(e);
      }
    });
    function cacheGet(path) {
      var valueStr = memCache[path] ? memCache[path] : localStorage.getItem(prefix+path);
      if(isDir(path)) {
        if(valueStr) {
          var value;
          try {
            value = JSON.parse(valueStr);
          } catch(e) {
            fire('error', e);
          }
          if(!value) {
            value = rebuildNow(path);
            memCache[path]=JSON.stringify(value);
            localStorage.setItem(prefix+path, memCache[path]);
          }
          return value;
        } else {
          return {};
        }
      } else {
        return valueStr;
      }
    }
    function isDir(path) {
      return path.substr(-1) == '/';
    }
    function getContainingDir(path) {
      // '' 'a' 'a/' 'a/b' 'a/b/' 'a/b/c' 'a/b/c/'
      var parts = path.split('/');
      // [''] ['a'] ['a', ''] ['a', 'b'] ['a', 'b', ''] ['a', 'b', 'c'] ['a', 'b', 'c', ''] 
      if(!parts[parts.length-1].length) {//last part is empty, so string was empty or had a trailing slash
        parts.pop();
      }
      // [] ['a'] ['a'] ['a', 'b'] ['a', 'b'] ['a', 'b', 'c'] ['a', 'b', 'c']
      if(parts.length) {//remove the filename or dirname
        parts.pop();
        // - [] [] ['a'] ['a'] ['a', 'b'] ['a', 'b']
        return parts.join('/')+(parts.length?'/':'');
        // - '' '' 'a/' 'a/' 'a/b/' 'a/b/'
      }
      return undefined;
      // undefined - - - - - -
    }
    function getFileName(path) {
      var parts = path.split('/');
      if(isDir(path)) {
        return parts[parts.length-2]+'/';
      } else {
        return parts[parts.length-1];
      }
    }
    function getCurrTimestamp() {
      return now;
    }
    function rebuildNow(path) {
      var obj = {};
      for(var i=0; i<localStorage.length; i++) {
        var key = localStorage.key(i);
        if(key.length > prefix.length+path.length && key.substr(0, prefix.length+path.length)==prefix+path) {
          obj[getFileName(key)]=getCurrTimestamp();
        }
      }
      for(var key in memCache) {
        if(key.length > prefix.length+path.length && key.substr(0, prefix.length+path.length)==prefix+path) {
          obj[getFileName(key)]=getCurrTimestamp();
        }
      }
      return obj;
    }
    function cacheSet(path, valueStr) {
      var containingDir = getContainingDir(path);
      if(containingDir) {
        currIndex = cacheGet(containingDir);
        currIndex[getFileName(path)] = getCurrTimestamp();
        cacheSet(containingDir, JSON.stringify(currIndex));
      }
      memCache[path] = valueStr;
      return localStorage.setItem(prefix+path, valueStr);
    }
    function cacheRemove(path) {
      var containingDir = getContainingDir(path);
      if(containingDir) {
        var fileName = getFileName(path);
        currIndex = cacheGet(containingDir);
        if(currIndex[fileName]) {
          delete currIndex[fileName];
          cacheSet(containingDir, JSON.stringify(currIndex));
        }
      }
      memCache[path] = undefined;
      return localStorage.removeItem(prefix+path);
    }
    function on(eventName, cb) {
      if(eventName=='change') {
        handlers.change.push(cb);
      }
    }
    function getPrivate(path) {
      return cacheGet(moduleName+'/'+path);
    }
    function getPublic(path) {
      return cacheGet('public/'+moduleName+'/'+path);
    }
    function setPrivate(path, valueStr) {
      return set(moduleName+'/'+path, valueStr);
    }
    function setPublic(path, valueStr) {
      return set('public/'+moduleName+'/'+path, valueStr);
    }
    function set(absPath, valueStr) {
      session.notifySet(absPath, valueStr, function(err) {
        if(err) {
          fire('error', err);
        }
      });
      var ret = cacheSet(absPath, valueStr);
      fire('change', {
        origin: 'tab',
        path: absPath,
        oldValue: cacheGet(absPath),
        newValue: valueStr
      });
      return ret; 
    }
    function removePrivate(path) {
      remove(moduleName+'/'+path);
    }
    function removePublic(path) {
      remove('public/'+moduleName+'/'+path);
    }
    function remove(absPath) {
      session.notifyRemove(absPath, function(err) {
        if(err) {
          fire('error', err);
        }
      });
      var ret = cacheRemove(absPath);
      fire('change', {
        origin: 'tab',
        path: absPath,
        oldValue: cacheGet(absPath),
        newValue: undefined
      });
      return ret;
    }
    function push(path) {
      if(isDir(path)) {
        doSync(path);
      } else {
        session.notifySet(path, cacheGet(path));
      }
    }
    function pull(path) {
      if(isDir(key)) {
        sync(path);
      } else {
        session.getRemote(path, function(err, data) {
          if(err) {
            fire('error', err);
          } else {
            cacheSet(path, data);
          }
        });
      }
    }
    function doMerge(path, localIndex, remoteIndex) {
      for(var key in localIndex) {
        if(localIndex[key] > remoteIndex[key]) {
          push(path+'/'+key);
        }
      }
      for(var key in remoteIndex) {
        if(remoteIndex[key] > localIndex[key]) {
          pull(path+'/'+key);
        }
      }
    }
    function doSync(path) {
      session.remoteGet(path, function(err, data) {
        if(err) {
          fire('error', err);
        } else {
          doMerge(path, cacheGet(path), data);
        }
      });
    }
    function syncPrivate(path) {
      doSync(moduleName+'/'+path);
    }
    function syncPublic(path) {
      doSync('public/'+moduleName+'/'+path);
    }
    
    return {
      on: on,//error,change(origin=tab,device,cloud)
      
      getPrivate    : getPrivate,
      setPrivate    : setPrivate,
      removePrivate : removePrivate,
      syncPrivate   : syncPrivate,

      getPublic    : getPublic,
      setPublic    : setPublic,
      removePublic : removePublic,
      syncPublic   : syncPublic
    };
  }
  
  return {
    create: create
  };
});