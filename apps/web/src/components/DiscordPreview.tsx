import Image from 'next/image';
export function DiscordPreview() {
  return (
    <figure>
      <div className="mb-4 flex items-center gap-3">
        <Image
          src="/brand/unit-talk-discord.svg"
          width={44}
          height={44}
          alt=""
        />
        <span className="text-sm font-semibold">
          The Unit Talk member experience
        </span>
      </div>
      <div className="ut-preview-rows">
        <div>
          <p className="ut-eyebrow">01 / Official picks</p>
          <p>The official-pick feed is a Trial and VIP entitlement.</p>
        </div>
        <div>
          <p className="ut-eyebrow">02 / Settled record</p>
          <p>Settled results and corrections belong across every tier.</p>
        </div>
        <div>
          <p className="ut-eyebrow">03 / Community</p>
          <p>Discussion, education and support appropriate to membership.</p>
        </div>
      </div>
      <figcaption className="ut-text-muted mt-4 text-xs leading-relaxed">
        Illustrative product structure — not a live Discord screenshot,
        conversation or performance record.
      </figcaption>
    </figure>
  );
}
