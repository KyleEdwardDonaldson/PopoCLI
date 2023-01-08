using DataAccess.Entities;
using OpenQA.Selenium;
using OpenQA.Selenium.Chrome;
using OpenQA.Selenium.Interactions;
using System.Text.RegularExpressions;

namespace DataAccess
{
    public class CenapredScraper
    {
        private const string _search = "https://www.gob.mx/cenapred/archivo/articulos?utf8=%E2%9C%93&q=Popocat%C3%A9petl+hoy&site=cenapred&section=articulos&fechaInicio={0}%2F{1}%2F{2}&fechaFin={3}%2F{4}%2F{5}";//7%22+%22de%22+%22enero%22+%222022%22
        private static CenapredData _data;
        private static Regex _exhalations = new Regex("([0-9]|[1-9][0-9]|[1-9][0-9][0-9])( exhalaciones)");
        private static Regex _tremor = new Regex("([0-9]|[1-9][0-9]|[1-9][0-9][0-9])( minutos de tremor)");
        private static Regex _explosions = new Regex("([^\\s]+)( explosiones)");

        public static CenapredData? Scrape(DateTime date)
        {
            _data = new CenapredData();

            using (var driver = SeleniumHelper.SetupChromeDriver())
            {
                var error = OpenInitialArticle(date, driver);

                var article = driver.WaitUntilElementClickable(By.XPath("//div[@class='article-body']//p"));

                _data.Exhalations = error ?? GetExhalations(article);
                _data.MinutesOfTremor = error ?? GetMinutesOfTremors(article);
                _data.Explosions = error ?? GetExplosions(article);

                error = error ?? OpenFullArticle(driver);

                _data.DirectionOfPlume = error ?? GetDirection(driver);
                _data.Phase = error ?? GetPhase(driver);
            }

            return _data;
        }

        private static string? OpenInitialArticle(DateTime date, ChromeDriver driver)
        {
            try
            {
                var articleSearch = string.Format(_search, date.Day, date.Month, date.Year, date.Day, date.Month, date.Year);

                SeleniumHelper.OpenPage(driver, articleSearch);

                var openArticle = driver.WaitUntilElementClickable(By.XPath("//article//a[text()='Continuar leyendo']"));
                openArticle.Click();
            }
            catch
            {
                return $"Unable to find article for date {date.ToString("dd-MMM-yyyy")}";
            }

            GoToNextTab(driver);

            return null;
        }

        private static string? OpenFullArticle(ChromeDriver driver)
        {
            try
            {
                var openFull = driver.WaitUntilElementClickable(By.XPath("//a[contains(@href,'reportesVolcanGobMX')]"));
                openFull.Click();
            }
            catch
            {
                return "Unable to find full article";
            }

            GoToNextTab(driver);

            return null;
        }

        private static string GetExhalations(IWebElement article)
        {
            var text = article.Text;
            var exhalations = _exhalations.Match(text);

            if (!exhalations.Success)
            {
                return "Could not find exhalations data";
            }

            return exhalations.Value.Substring(0, exhalations.Value.IndexOf(' '));
        }

        private static string GetMinutesOfTremors(IWebElement article)
        {
            var text = article.Text;
            var tremors = _tremor.Match(text);

            if (!tremors.Success)
            {
                return "Could not find tremor data";
            }

            return tremors.Value[..tremors.Value.IndexOf(' ')];
        }

        private static string GetExplosions(IWebElement article)
        {
            var text = article.Text;
            var explosions = _explosions.Match(text);

            if (!explosions.Success)
            {
                return "Could not find explosion data";
            }

            var numberOfExplosionsInSpanish = explosions.Value.Substring(0, explosions.Value.IndexOf(' ')).ToLower();

            switch (numberOfExplosionsInSpanish)
            {
                case "uno":
                    return "1";
                case "dos":
                    return "2";
                case "tres":
                    return "3";
                case "cuatro":
                    return "4";
                case "cinco":
                    return "5";
                case "seis":
                    return "6";
                case "siete":
                    return "7";
                case "ocho":
                    return "8";
                case "nueve":
                    return "9";
                case "diez":
                    return "10";
                case "once":
                    return "11";
                case "doce":
                    return "12";
                case "trece":
                    return "13";
                case "catorce":
                    return "14";
                case "quince":
                    return "15";
                case "dieciséis":
                    return "16";
                case "diecisiete":
                    return "17";
                case "dieciocho":
                    return "18";
                case "diecinueve":
                    return "19";
                case "veinte":
                    return "20";
                default:
                    break;
            }

            return "Could not find explosion data";
        }

        private static string GetPhase(ChromeDriver driver)
        {
            var phaseElement = driver.WaitUntilElementClickable(By.XPath("//h4[text()[normalize-space() = 'Semáforo de alerta volcánica']]//../following::div//b"));

            var phase = phaseElement.Text.ToLower();

            if (phase.Contains("amarillo"))
            {
                return "YELLOW - PHASE 2";
            }
            else if (phase.Contains("verde")) {
                return "GREEN - PHASE 1";
            }  
            else if (phase.Contains("rojo"))
            {
                return "RED - PHASE 3";
            }

            return "Could not find the phase";
        }

        private static string GetDirection(ChromeDriver driver)
        {
            var plumeElement = driver.WaitUntilElementClickable(By.XPath("//h4[.//text()[normalize-space() = 'Dirección de la pluma']]//../following::div//p//b"));

            return plumeElement.Text.ToLower() switch
            {
                "nor" => "North",
                "este" => "East",
                "sur" => "South",
                "oeste" => "West",
                "noreste" => "North East",
                "noroeste" => "North West",
                "suroeste" => "South West",
                "sureste" => "South East",
                "estesureste" => "East South East",
                "sursureste" => "South South East",
                "oestesuroeste" => "West South West",
                "sursuroeste" => "South South West",
                "oestenoroeste" => "West North West",
                "nornoroeste" => "North North West",
                "nornoreste" => "North North East",
                "estenoreste" => "East North East",
                _ => plumeElement.Text,
            };
        }

        private static void GoToNextTab(ChromeDriver driver)
        {
            var current = driver.CurrentWindowHandle;
            var indexOfCurrent = driver.WindowHandles.IndexOf(current);

            driver.SwitchTo().Window(driver.WindowHandles.Last());
        }
    }
}