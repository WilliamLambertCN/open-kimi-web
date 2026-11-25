export const sessionMediaFixture = 'const routes={getFileDownloadUrl:"session",downloadSessionFile:"session",' +
  'getSessionMediaUrl:"session",getSessionMediaBlob:"session"};' +
  'class Router{constructor(local,remote){this.local=local;this.remote=remote;this.sessionHost=new Map;' +
  'this.lookups=new Map;this.hosts=new Map([["remote",remote]])}' +
  'whenReady(){return Promise.resolve()}apiFor(host){return host===void 0?this.local:this.remote}' +
  'setSessionHost(id,host){this.sessionHost.set(id,host)}call(method,...args){return this.dispatch(method,routes[method],args)}' +
  'dispatch(t,n,o){const i=o[0];if(n==="session"||n==="localSession"){const a=this.sessionHost.get(i);' +
  'return a===void 0?this.dispatchUnknownSession(t,n,o):this.dispatchSession(t,n,o,a??void 0)}' +
  'const s=n==="workspace"?this.workspaceHost.get(i):n==="file"?this.fileHost.get(i):void 0,r=this.apiFor(s);' +
  'return r[t].apply(r,o)}' +
  'async dispatchUnknownSession(t,n,o){const i=o[0];if(await this.whenReady(),this.hosts.size===0)' +
  'return this.dispatchSession(t,n,o,void 0);const s=await this.lookUp(i);' +
  'return t==="getSession"?s:this.dispatchSession(t,n,o,s.hostId)}' +
  'lookUp(t){const n=this.lookups.get(t);if(n!==void 0)return n;' +
  'const o=this.local.findSession(t).then(i=>(this.setSessionHost(i.id,i.hostId??null),i))' +
  '.finally(()=>{this.lookups.delete(t)});return this.lookups.set(t,o),o}' +
  'async ownerOf(t){const n=this.sessionHost.get(t);if(n!==void 0)return n??void 0;' +
  'if(await this.whenReady(),this.hosts.size!==0)return this.lookUp(t).then(o=>o.hostId)}' +
  'dispatchSession(t,n,o,i){if(n==="localSession"&&i!==void 0)' +
  'return Promise.reject(new Error("This action is not available for projects on a remote host"));' +
  'const s=this.apiFor(i),r=s[t].apply(s,o);return t==="forkSession"?' +
  'r.then(a=>(a.id!==void 0&&this.setSessionHost(a.id,i??null),a)):r}}';
