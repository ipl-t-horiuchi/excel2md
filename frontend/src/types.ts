export interface SheetResult {
  name: string
  markdown: string
  /** true = AI（Bedrock）で変換済み */
  aiConverted?: boolean
}
