using DataAccess.Entities;
using OpenQA.Selenium;
using OpenQA.Selenium.Chrome;
using OpenQA.Selenium.Interactions;

namespace DataAccess
{
    public class CenapredScraper
    {
        private const string _search = "https://www.gob.mx/cenapred/archivo/articulos?utf8=%E2%9C%93&q=Popocat%C3%A9petl&site=cenapred&section=articulos&fechaInicio={0}%2F{1}%2F{2}&fechaFin={3}%2F{4}%2F{5}";//7%22+%22de%22+%22enero%22+%222022%22

        public static CenapredData? Scrape(DateTime date)
        {
            var data = new CenapredData();
            using (var driver = SeleniumHelper.SetupChromeDriver())
            {
                BetterOpenPageForDate(date, driver);

                data.DirectionOfPlume = GetDirection(driver);
                data.Phase = GetPhase(driver);
            }

            return data;
        }

        private static ChromeDriver BetterOpenPageForDate(DateTime date, ChromeDriver driver)
        {
            var articleSearch = string.Format(_search, date.Day, date.Month, date.Year, date.Day, date.Month, date.Year);

            SeleniumHelper.OpenPage(driver, articleSearch);

            var openArticle = driver.WaitUntilElementClickable(By.XPath("//article//a[text()='Continuar leyendo']"));
            openArticle.Click();

            GoToNextTab(driver);

            var openFull = driver.WaitUntilElementClickable(By.XPath("//a[contains(@href,'cenapred.unam.mx/reportesVolcanGobMX/')]"));
            openFull.Click();

            GoToNextTab(driver);

            return driver;
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

            return "N/A";
        }

        private static string GetDirection(ChromeDriver driver)
        {
            var plumeElement = driver.WaitUntilElementClickable(By.XPath("//h4[.//text()[normalize-space() = 'Dirección de la pluma']]//../following::div//p//b"));

            return plumeElement.Text.ToLower() switch
            {
                "nor" => "North",
                "este" => "East",
                "sur" => "South",
                "ooeste" => "West",
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

            driver.SwitchTo().Window(driver.WindowHandles[indexOfCurrent + 1]);
        }
    }
}