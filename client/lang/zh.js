// 中文语言包。游戏自己的错误键（例如 count21.err.range）也放这里，按游戏分组。

const zh = {
  'err.no_hello': '还没连上服务器，请稍等',
  'err.internal': '服务器出错了，请截图告诉房主',
  'err.unknown_type': '不支持的操作',
  'err.unknown_game': '没有这个游戏',
  'err.no_room': '找不到这个房间，检查一下房间码',
  'err.room_full': '房间已经满了',
  'err.room_playing': '这一局已经开始了',
  'err.not_in_room': '你不在房间里',
  'err.not_lobby': '对局中不能改',
  'err.host_only': '只有房主能这样做',
  'err.bad_option': '选项不对',
  'err.no_bots': '这个游戏还没有电脑玩家',
  'err.bad_seat': '这个座位不行',
  'err.not_enough_players': '人数还不够',
  'err.not_all_ready': '还有人没准备',
  'err.not_ended': '对局还没结束',
  'err.not_playing': '现在不在对局中',
  'err.not_your_turn': '还没轮到你',
  'err.unknown_move': '不认识这个操作',
  'err.bad_args': '操作参数不对',
  'err.game_over': '对局已经结束了',
  'err.illegal': '这样出不行',

  'kittens.err.no_card': '你没有这张牌',
  'kittens.err.bad_combo': '这几张牌不能这样出',
  'kittens.err.bad_target': '选一个还在场上的人',
  'kittens.err.target_empty': '对方手里没牌了',
  'kittens.err.bad_named': '点名的牌不对',
  'kittens.err.nothing_to_nope': '现在没有可以「不要」的牌',
  'kittens.err.out': '你已经出局了',
  'kittens.err.bad_pos': '位置不对',

  'count21.err.range': '每次只能加 1 到 3',
  'count21.err.over': '超过目标数了',
};

/** @param {string} key */
export function t(key) {
  return zh[key] || key;
}
