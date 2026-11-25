// An error the routes turn into a JSON response with this status and body.
export class HttpError extends Error {
  constructor(
    public status: number,
    public body: { code: string; message?: string; [key: string]: unknown },
  ) {
    super(body.message ?? body.code);
  }
}

export const GENERIC_PAYMENT_ERROR = "Não conseguimos concluir o pagamento agora. Tente de novo em alguns segundos.";

// Shown on the checkout page when the card is declined. `code` is Stripe's decline_code or error code.
export function declineMessage(code?: string | null): string {
  switch (code) {
    case "insufficient_funds":
      return "Seu cartão foi recusado por saldo insuficiente. Tente outro cartão ou pague com Pix.";
    case "expired_card":
      return "Seu cartão está vencido. Tente outro cartão ou pague com Pix.";
    case "incorrect_cvc":
    case "invalid_cvc":
      return "O código de segurança do cartão está incorreto. Confira e tente de novo.";
    case "authentication_required":
    case "payment_intent_authentication_failure":
      return "Seu banco pediu uma confirmação que não foi concluída. Tente de novo.";
    default:
      return "Seu cartão foi recusado. Tente outro cartão ou pague com Pix.";
  }
}
