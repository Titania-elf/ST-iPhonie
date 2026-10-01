/** Connect only from the settings iframe mounted by this extension. */
export function connectBackend(view = window) {
    let bridge;
    try { bridge = view.parent.__stIphoniePanelBridge; }
    catch { throw Error('请从酒馆的 ST-iPhonie 入口打开小手机'); }
    if (!bridge?.connect) throw Error('请从酒馆的 ST-iPhonie 入口打开小手机');
    const api = bridge.connect(view);
    if (api.apiVersion?.split('.')[0] !== '1') throw Error('功能层版本不匹配，请更新完整插件');
    return api;
}