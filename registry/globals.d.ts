declare module "*.svg" {
  const content: string | { src: string; width: number; height: number };
  export default content;
}
