declare module 'jsbarcode' {
  interface JsBarcodeOptions {
    format?: string
    width?: number
    height?: number
    displayValue?: boolean
    margin?: number
    background?: string
    lineColor?: string
  }
  function JsBarcode(element: Element | string, data: string, options?: JsBarcodeOptions): void
  export default JsBarcode
}
