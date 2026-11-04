import { useTranslation } from "react-i18next";
import { SUPPORTED_LANGUAGES, setLanguage, type Language } from "../i18n";

export function LanguageSelect() {
  const { t, i18n } = useTranslation();

  return (
    <label className="language">
      {t("language.label")}
      <select
        value={i18n.language}
        onChange={(event) => setLanguage(event.target.value as Language)}
      >
        {SUPPORTED_LANGUAGES.map((language) => (
          <option key={language} value={language}>
            {t(`language.${language}`)}
          </option>
        ))}
      </select>
    </label>
  );
}
