// tsconfig.web.json does not pull in `vite/client`, so the project has no `*?url` module type.
// Only the PDF body uses one (D75): Vite emits the pdf.js worker as an asset and gives its URL.
declare module '*?url' {
  const url: string
  export default url
}
