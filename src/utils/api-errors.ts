import { Response } from "express";

class ApiError {
  constructor(
    res: Response,
    status: number,
    msg: string | Record<string, any>
  ) {
    if (typeof msg === "string") {
      console.error(`\n\nError: ${status} - ${msg}`);
      return res.status(status).send(msg);
    }

    console.error(`\n\nError: ${status} - ${JSON.stringify(msg)}`);
    return res.status(status).json(msg);
  }

  static badRequest(res: Response, msg: string) {
    return new ApiError(res, 400, msg);
  }

  static unauthorized(res: Response, msg: string) {
    let error = {
      auth: false,
      error: "User Unauthorized",
    };

    if (msg) error.error = msg;

    return new ApiError(res, 401, error);
  }

  static forbidden(res: Response, msg: string) {
    let error = {
      auth: false,
      error: "User with no access",
    };

    if (msg) error.error = msg;

    return new ApiError(res, 403, error);
  }

  static internalServerError(res: Response, msg: string) {
    return new ApiError(res, 500, msg);
  }
}

export default ApiError;
