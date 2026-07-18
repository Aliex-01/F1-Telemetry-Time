// Barrera de errores: si un componente revienta al pintar, React desmonta todo
// el arbol y la pagina se queda EN BLANCO, sin pista de que ha pasado. Esto lo
// acota: el resto de la app sigue viva y se ve el error.
//
// Tiene que ser un componente de clase: los hooks no capturan errores de render.
import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** Que se estaba pintando, para el mensaje ("la torre de tiempos"). */
  what?: string;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Error al pintar", this.props.what ?? "", error, info);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="status error">
        <strong>Se rompió {this.props.what ?? "esta parte"}.</strong>{" "}
        {error.message}
        <br />
        <small>
          Suele pasar si el backend y el frontend no van sincronizados: reinicia el
          backend (no basta con recargar la página). Los detalles están en la consola.
        </small>
        <br />
        <button onClick={() => this.setState({ error: null })}>Reintentar</button>
      </div>
    );
  }
}
