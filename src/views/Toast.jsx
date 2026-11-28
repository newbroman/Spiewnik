import React from "react";

export default function Toast({ toast }) {
  return <div className={"kl-toast" + (toast ? " show" : "")}>{toast}</div>;
}
