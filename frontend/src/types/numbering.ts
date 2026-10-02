/**
 * 已注销的标本编号。
 * 采集地改代码或合并回填时，标本的旧编号退役并登记在此，
 * 采集登记发新号时必须避开，防止旧标签上的号码被再次发出。
 */
export interface RetiredCode {
  /** 退役的旧编号（主键） */
  code: string
  /** 回填后的新编号 */
  replacedBy: string
  /** 注销日期 */
  retiredAt: string
}
