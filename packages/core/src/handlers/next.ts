import type { BirrInstance } from "../core/create-birr";

export function birrHandler(birr: Pick<BirrInstance, "handler">): {
  GET: (request: Request) => Promise<Response>;
  POST: (request: Request) => Promise<Response>;
} {
  return {
    GET: birr.handler,
    POST: birr.handler,
  };
}
