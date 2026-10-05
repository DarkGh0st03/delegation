export class GatewayError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = "GatewayError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

export class VerificationRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VerificationRejectedError";
  }
}

export class VerificationUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VerificationUnavailableError";
  }
}
