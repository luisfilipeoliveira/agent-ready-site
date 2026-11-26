import type { Metadata } from "next";
import { Footer } from "@/components/footer";

export const metadata: Metadata = { title: "Bike fitting, Example Bikes" };

export default function BikeFitting() {
  return (
    <>
      <main>
        <h1>Bike fitting</h1>
        <p>A one-hour fitting that sets a bike up around its rider.</p>
        <h2>Problem</h2>
        <p>Riders on a badly set-up bike get sore knees and backs, and stop riding after a few weeks.</p>
        <h2>What we do</h2>
        <p>We measure the rider, adjust saddle, bars and cleats, and check the result on a short ride.</p>
        <h2>Outcome</h2>
        <p>Nine in ten riders we fit come back for the yearly check.</p>
      </main>
      <Footer />
    </>
  );
}
