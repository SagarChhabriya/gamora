export const requestIdHeader = "x-request-id";

function createRequestId() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (value) => {
    const random = Math.floor(Math.random() * 16);
    const nibble = value === "x" ? random : (random & 0x3) | 0x8;
    return nibble.toString(16);
  });
}

export function getOrCreateRequestId(value: string | null): string {
  return value ?? createRequestId();
}
