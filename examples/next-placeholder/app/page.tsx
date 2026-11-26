import Link from "next/link";
import { Footer } from "@/components/footer";

export default function Home() {
  return (
    <>
      <main>
        <h1>Example Bikes</h1>
        <p>Bike shop that sells, fits and repairs city, road and electric bikes.</p>
        <h2>Bikes we sell</h2>
        <ul>
          <li>City bikes for the daily commute.</li>
          <li>Road bikes for longer rides.</li>
          <li>Electric bikes for hills and heavy loads.</li>
        </ul>
        <h2>Services</h2>
        <ul>
          <li>
            <Link href="/services/bike-fitting">Bike fitting</Link>: a one-hour fitting that sets a bike up around its rider.
          </li>
        </ul>
        <h2>Brands we stock</h2>
        <p>Brand One, Brand Two, Brand Three.</p>
      </main>
      <Footer />
    </>
  );
}
