using DataAccess.Entities;
using OpenQA.Selenium;
using OpenQA.Selenium.Chrome;
using OpenQA.Selenium.Interactions;

namespace DataAccess
{
    public class CenapredScraper
    {
        private const string _archive = "https://www.gob.mx/cenapred/archivo/articulos?idiom=es&&filter_origin=archive";

        public static CenapredData? Scrape(DateTime date)
        {
            var data = new CenapredData();

            var driver = OpenPageForDate(date);

            data.DirectionOfPlume = GetDirectionOfPlume(driver);
            data.Phase = GetPhase(driver);

            return data;
        }

        private static ChromeDriver OpenPageForDate(DateTime date)
        {
            var shortDate = date.ToString("d");

            var driver = SeleniumHelper.SetupChromeDriver();
            SeleniumHelper.OpenPage(driver, _archive);

            var filterButton = driver.WaitUntilElementClickable(By.XPath("//a[.//text()[normalize-space() = 'Búsqueda avanzada'] ]"));
            filterButton.Click();

            var fromDate = driver.WaitUntilElementClickable(By.Id("fechaInicio"));
            var toDate = driver.WaitUntilElementClickable(By.Id("fechaFin"));

            fromDate.SendKeys(shortDate);
            toDate.SendKeys(shortDate);

            var searchField = driver.WaitUntilElementClickable(By.Id("q"));
            searchField.SendKeys("Popocatépetl");
            searchField.Click();

            var submitSearch = driver.WaitUntilElementClickable(By.XPath("//input[@type='submit'][@value='Buscar']"));
            submitSearch.Click();

            var openArticle = driver.WaitUntilElementClickable(By.XPath("//article//a[text()='Continuar leyendo']"));
            openArticle.Click();

            ((IJavaScriptExecutor)driver).ExecuteScript("window.open();");
            driver.SwitchTo().Window(driver.WindowHandles.Last());

            var openFull = driver.WaitUntilElementClickable(By.XPath("//strong[text()='Para ver el reporte completo:']"));
            openFull.Click();

            return driver;
        }

        private static string GetDirectionOfPlume(ChromeDriver driver)
        {
            var plumeElement = driver.WaitUntilElementClickable(By.XPath("//h4[.//text()[normalize-space() = 'Dirección de la pluma']]//../following::div//p//b"));

            return plumeElement.Text;
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
    }
}