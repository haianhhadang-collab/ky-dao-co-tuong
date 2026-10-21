/*
 * Hệ thống điểm, cấp bậc (5 hạng × 5 sao) và danh hiệu – dùng chung cho server và trình duyệt.
 * Muốn đổi ngưỡng điểm hay điều kiện danh hiệu thì chỉ cần sửa các bảng bên dưới.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Ranks = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // width = số điểm cho mỗi sao của hạng đó
  const RANKS = [
    { key: 'tapsu', name: 'Tập sự', color: '#8fa3a8', width: 100 },
    { key: 'phongtrao', name: 'Phong trào', color: '#3fae5a', width: 150 },
    { key: 'kythu', name: 'Kỳ thủ', color: '#3b8fe0', width: 200 },
    { key: 'kientuong', name: 'Kiện tướng', color: '#a45ee5', width: 250 },
    { key: 'kyvuong', name: 'Kỳ vương', color: '#f0a92e', width: 300 }
  ];
  const STARS = ['Nhất tinh', 'Nhị tinh', 'Tam tinh', 'Tứ tinh', 'Ngũ tinh'];

  const TIERS = [];
  (function build() {
    let acc = 0;
    RANKS.forEach((rk, ri) => {
      STARS.forEach((st, si) => {
        TIERS.push({ index: TIERS.length, rank: ri, star: si + 1, min: acc, name: rk.name + ' ' + st, rankName: rk.name, starName: st, color: rk.color });
        acc += rk.width;
      });
    });
  })();

  function tierIndex(points) {
    let i = 0;
    while (i + 1 < TIERS.length && points >= TIERS[i + 1].min) i++;
    return i;
  }

  /** Thông tin cấp bậc từ điểm: tên, sao, tiến độ lên sao kế tiếp. */
  function rankOf(points) {
    points = Math.max(0, points | 0);
    const i = tierIndex(points), t = TIERS[i], next = TIERS[i + 1] || null;
    const span = next ? next.min - t.min : 1;
    return Object.assign({}, t, {
      points,
      next: next ? next.min : null,
      nextName: next ? next.name : null,
      progress: next ? (points - t.min) / span : 1
    });
  }

  /**
   * Điểm cộng/trừ sau một ván tính điểm.
   * score: 1 thắng, 0.5 hòa, 0 thua. streak: chuỗi thắng sau ván này.
   */
  function pointDelta(my, opp, score, streak) {
    const E = 1 / (1 + Math.pow(10, (opp - my) / 400));
    if (score === 1) {
      const bonus = Math.min(10, Math.max(0, streak - 2) * 2); // thưởng chuỗi thắng
      return Math.round(20 + 20 * (1 - E)) + bonus;
    }
    if (score === 0) {
      let d = Math.round(10 + 20 * E);
      if (my < TIERS[5].min) d = Math.ceil(d / 2); // bảo hộ hạng Tập sự
      return -Math.min(d, my);
    }
    const d = Math.round(20 * (0.5 - E));
    return Math.max(d, -my);
  }

  /*
   * Danh hiệu. kind:
   *  - streak: chuỗi thắng liên tiếp tốt nhất (bestStreak) ≥ need
   *  - wins:   tổng số ván thắng ≥ need (minTier: cần đạt cấp bậc tối thiểu)
   */
  const TITLES = [
    { id: 'lien_sat', name: 'Liên sát', kind: 'streak', need: 3 },
    { id: 'tu_sat', name: 'Tứ sát', kind: 'streak', need: 4 },
    { id: 'ngu_tinh_lao_tuong', name: 'Ngũ tinh lão tướng', kind: 'streak', need: 5 },
    { id: 'luc_lo_anh_hung', name: 'Lục lộ anh hùng', kind: 'streak', need: 6 },
    { id: 'that_bo_truy_hon', name: 'Thất bộ truy hồn', kind: 'streak', need: 7 },
    { id: 'bat_phuong_uy_chan', name: 'Bát phương uy chấn', kind: 'streak', need: 8 },
    { id: 'cuu_thien_chien_tuong', name: 'Cửu thiên chiến tướng', kind: 'streak', need: 9 },
    { id: 'thap_nhan_tram', name: 'Thập nhân trảm', kind: 'streak', need: 10 },
    { id: 'bach_nhan_tram', name: 'Bách nhân trảm', kind: 'wins', need: 100 },
    { id: 'ngu_bach_ho_tuong', name: 'Ngũ bách hổ tướng', kind: 'wins', need: 500 },
    { id: 'thien_nhan_tram', name: 'Thiên nhân trảm', kind: 'wins', need: 1000 },
    { id: 'tam_thien_ba_chu', name: 'Tam thiên bá chủ', kind: 'wins', need: 3000 },
    { id: 'dai_kien_tuong', name: 'Đại kiện tướng', kind: 'wins', need: 5000, minTier: 15 },
    { id: 'ky_tien', name: 'Kỳ tiên', kind: 'wins', need: 10000, minTier: 24 }
  ];
  TITLES.forEach((t, i) => {
    t.order = i;
    let d = t.kind === 'streak' ? 'Thắng ' + t.need + ' ván liên tiếp' : 'Tổng cộng ' + t.need.toLocaleString('vi-VN') + ' ván thắng';
    if (t.minTier != null) d += ' và đạt ' + TIERS[t.minTier].name;
    t.desc = d;
  });
  const TITLE_BY_ID = {};
  TITLES.forEach(t => { TITLE_BY_ID[t.id] = t; });

  function qualifies(t, u) {
    if (t.kind === 'streak' && (u.bestStreak || 0) < t.need) return false;
    if (t.kind === 'wins' && (u.wins || 0) < t.need) return false;
    if (t.minTier != null && tierIndex(u.points || 0) < t.minTier) return false;
    return true;
  }

  /** Danh hiệu mới đạt được (chưa có trong u.titles). */
  function newTitles(u) {
    const have = new Set(u.titles || []);
    return TITLES.filter(t => !have.has(t.id) && qualifies(t, u)).map(t => t.id);
  }

  /** Danh hiệu cao nhất đã có. */
  function bestTitle(ids) {
    let best = null;
    for (const id of ids || []) {
      const t = TITLE_BY_ID[id];
      if (t && (!best || t.order > best.order)) best = t;
    }
    return best;
  }

  return { RANKS, STARS, TIERS, TITLES, TITLE_BY_ID, tierIndex, rankOf, pointDelta, newTitles, bestTitle, qualifies };
});
