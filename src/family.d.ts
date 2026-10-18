// The family kit's header switcher (src/family/switcher.js), a custom element used from JSX.
import 'react'

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'quaera-switcher': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & { app: string }
    }
  }
}
