import Link from "next/link";
import { Footer } from "@/components/footer";

export default function Home() {
  return (
    <>
      <main>
        <h1>Jane Doe</h1>
        <p>Product designer who turns messy checkout and onboarding flows into products people finish.</p>
        <h2>Selected work</h2>
        <ul>
          <li>
            <Link href="/work/atlas-checkout">Atlas checkout</Link>: a one-page checkout that lifted completed orders by 18%.
          </li>
        </ul>
        <h2>Clients</h2>
        <p>Client One, Client Two, Client Three.</p>
      </main>
      <Footer />
    </>
  );
}
