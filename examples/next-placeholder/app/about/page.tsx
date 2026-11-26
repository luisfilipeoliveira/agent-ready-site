import type { Metadata } from "next";
import { Footer } from "@/components/footer";

export const metadata: Metadata = { title: "About, Jane Doe" };

export default function About() {
  return (
    <>
      <main>
        <h1>About</h1>
        <p>I have designed digital products for twelve years, mostly commerce and fintech.</p>
        <h2>How I work</h2>
        <ul>
          <li>Start from the numbers the business already watches.</li>
          <li>Prototype early, test with five people, repeat.</li>
        </ul>
        <h2>Experience</h2>
        <p><strong>Example Company</strong>, Lead Product Designer, 2021 to now.</p>
        <p><strong>Sample Studio</strong>, Product Designer, 2016 to 2021.</p>
      </main>
      <Footer />
    </>
  );
}
