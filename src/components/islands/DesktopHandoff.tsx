export function DesktopHandoff() {
  return (
    <div className="fixed inset-0 z-50 flex min-h-screen items-center justify-center bg-(--paper) px-6 text-[#172321]">
      <div className="w-full max-w-[520px] text-center">
        <h1 className="text-[28px] font-semibold tracking-tight">Signed in.</h1>
        <p className="mt-3 text-[14px] leading-relaxed text-[#5d6d69]">
          Please close this window and return to the Obrenna desktop app.
        </p>
      </div>
    </div>
  )
}
