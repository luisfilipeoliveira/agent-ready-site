import type { Metadata } from "next";
import { Footer } from "@/components/footer";

export const metadata: Metadata = { title: "Atlas checkout, Jane Doe" };

export default function AtlasCheckout() {
  return (
    <>
      <main>
        <h1>Atlas checkout</h1>
        <p>A one-page checkout for a mid-size online shop.</p>
        <h2>Problem</h2>
        <p>Four steps and a forced sign-up lost a third of buyers between cart and payment.</p>
        <h2>What we did</h2>
        <p>One page, guest checkout first, address lookup and saved cards.</p>
        <h2>Outcome</h2>
        <p>Completed orders rose 18% in the first quarter.</p>
      </main>
      <Footer />
    </>
  );
}
