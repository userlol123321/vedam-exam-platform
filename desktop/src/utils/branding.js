// Branding helper: show the logged-in user's institution name instead of a
// hardcoded product name, so every college sees its own branding.
export function appTitle(user) {
  if (user?.role === "super_admin") return "Platform Owner Dashboard";
  return user?.institutionName || "Exam Platform";
}

// Initials for an avatar/logo (e.g. "VS" for "Vidyalankar School")
export function initials(name) {
  if (!name) return "EP";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}