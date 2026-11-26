import type { Metadata } from "next";
import { Footer } from "@/components/footer";

export const metadata: Metadata = { title: "About, Example Bikes" };

export default function About() {
  return (
    <>
      <main>
        <h1>About</h1>
        <p>We have sold and repaired bikes in Sample Town since 2014.</p>
        <h2>How we work</h2>
        <ul>
          <li>Every bike gets a test ride before you buy it.</li>
          <li>Repairs have fixed prices, agreed before we start.</li>
        </ul>
        <h2>Shops</h2>
        <p><strong>Example Bikes Centre</strong>, sales, workshop and fitting studio, 2014 to now.</p>
        <p><strong>Example Bikes Riverside</strong>, sales and quick repairs, 2020 to now.</p>
      </main>
      <Footer />
    </>
  );
}
