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

module.exports = {
  getHaversineDistance,
};
