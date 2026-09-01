declare module '@deepseek-ai/dsh-client-ui-primitives' {
  import type { ButtonHTMLAttributes, FunctionComponent } from 'react'
  export const Button: FunctionComponent<ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: string
    size?: string
  }>
}
