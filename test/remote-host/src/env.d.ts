declare module "invoices/Invoices" {
  export function mount(element: HTMLElement, options: { apiBase: string }): Promise<{ unmount: () => void }>;
}
