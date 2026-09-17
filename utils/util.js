const EARTH_RADIUS = 6371; // 地球半径，单位：公里

/**
 * 将角度转换为弧度
 * @param {number} d 角度
 * @returns {number} 弧度
 */
function getRad(d) {
  return (d * Math.PI) / 180.0;
}

/**
 * 基于Haversine公式计算两个坐标点之间的距离
 * @param {number} lat1 第一个点的纬度
 * @param {number} lng1 第一个点的经度
 * @param {number} lat2 第二个点的纬度
 * @param {number} lng2 第二个点的经度
 * @returns {number} 两个坐标点之间的距离，单位：公里
 */
function getHaversineDistance(lat1, lng1, lat2, lng2) {
  const radLat1 = getRad(lat1);
  const radLat2 = getRad(lat2);
  const a = radLat1 - radLat2;
  const b = getRad(lng1) - getRad(lng2);
  let s =
    2 *
    Math.asin(
      Math.sqrt(
        Math.pow(Math.sin(a / 2), 2) +
          Math.cos(radLat1) * Math.cos(radLat2) * Math.pow(Math.sin(b / 2), 2),
      ),
    );
  s = s * EARTH_RADIUS;
  s = Math.round(s * 100) / 100; // 输出为公里，保留两位小数
  return s;
}

// onShow 全量刷新的默认最小间隔。
// 取得比较短（3 秒）是为了只去重「用户快速来回切 tab」这种无意义重复请求，
// 而不会让用户感知到数据陈旧 —— 例如发布完成跳到订单页时，间隔通常已远超 3 秒。
const DEFAULT_REFRESH_GAP_MS = 3000;

/**
 * 生成一个刷新节流器：距上次通过不足 intervalMs 时返回 false。
 *
 * 用法：在页面里创建一次，onShow 时调用。
 *   const shouldRefresh = createRefreshThrottle();
 *   onShow() { if (this.data.initialized && shouldRefresh()) this.loadData(false); }
 *
 * @param {number} [intervalMs] 最小间隔，默认 3000 毫秒
 * @returns {function(): boolean} 是否应当执行本次刷新
 */
function createRefreshThrottle(intervalMs) {
  const gap =
    Number(intervalMs) > 0 ? Number(intervalMs) : DEFAULT_REFRESH_GAP_MS;
  let lastAt = 0;

  return function shouldRefresh() {
    const current = Date.now();
    if (lastAt && current - lastAt < gap) {
      return false;
    }
    lastAt = current;
    return true;
  };
}

module.exports = {
  getHaversineDistance,
  createRefreshThrottle,
  DEFAULT_REFRESH_GAP_MS,
};
