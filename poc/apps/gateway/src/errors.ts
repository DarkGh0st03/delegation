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

export class PolicyUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PolicyUnavailableError";
  }
}

export class ProviderUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderUnavailableError";
  }
}

export class ProviderNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderNotFoundError";
  }
}

export class ProviderOperationUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderOperationUnavailableError";
  }
}
