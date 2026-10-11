{
  const errors = new Map([
    ['请求内容过大', 'Request body is too large'],
    ['Base URL 格式无效', 'Invalid Base URL'],
    ['Base URL 仅支持 http 或 https', 'Base URL must use http or https'],
    ['Base URL 不能包含凭据', 'Base URL must not include credentials'],
    ['模型端点返回了无法识别的格式', 'The model endpoint returned an unrecognized format'],
    ['模型端点响应过大', 'The model endpoint response is too large'],
    ['模型端点返回了空响应', 'The model endpoint returned an empty response'],
    ['模型端点未返回有效 JSON', 'The model endpoint did not return valid JSON'],
    ['无法连接模型端点', 'Could not connect to the model endpoint'],
    ['模型端点返回重定向，请直接填写最终 Base URL', 'The model endpoint redirected; enter its final Base URL'],
    ['页面授权无效或已过期', 'Page authorization is invalid or expired'],
    ['请求不是有效 JSON', 'The request is not valid JSON'],
    ['模型拉取失败', 'Could not fetch models'],
    ['请先填写 Base URL', 'Enter a Base URL first'],
    ['API Key 格式无效', 'Invalid API Key format'],
    ['API 协议格式无效', 'Invalid API protocol format'],
  ]);
  window.__okwProviderCreateCopy = (copy, isChinese) => {
    const nodes = new Map();
    const bind = (node, read, attribute = '') => {
      const bindings = nodes.get(node) ?? new Map();
      bindings.set(attribute, read);
      nodes.set(node, bindings);
      const value = read();
      if (attribute) {
        if (node.getAttribute?.(attribute) !== value) node.setAttribute(attribute, value);
      } else if (node.textContent !== value) node.textContent = value;
    };
    const text = (node, key, ...args) => bind(node, () => {
      const value = copy()[key];
      return typeof value === 'function' ? value(...args) : value;
    });
    const refresh = () => {
      for (const [node, bindings] of nodes) {
        if (node.isConnected === false) { nodes.delete(node); continue; }
        for (const [attribute, read] of bindings) bind(node, read, attribute);
      }
    };
    const error = (message) => {
      if (isChinese()) return message;
      const status = /^模型端点请求失败（HTTP (\d+)）$/.exec(message);
      return status ? `Model endpoint request failed (HTTP ${status[1]})` : errors.get(message) ?? message;
    };
    return { bind, error, refresh, text };
  };
}
