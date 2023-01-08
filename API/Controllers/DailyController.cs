using DataAccess.Entities;
using Microsoft.AspNetCore.Mvc;

namespace RESTPopocatepetl.Controllers
{
    [ApiController]
    [Route("[controller]")]
    public class DailyController : ControllerBase
    {
        [HttpGet(template: "{date}", Name = "All Data for Date")]
        public ActionResult Data(string date)
        {
            var dateTime = new DateTime();
            var error = ValidateDate(date, ref dateTime);

            if (error != null)
            {
                return error;
            }

            var data = CenapredData.TryGetData(dateTime);

            if (data == null)
            {
                return NotFound();
            }

            return Ok(data);
        }

        [HttpGet(template: "{date}/exhalations", Name = "Exhalations")]
        public ActionResult Exhalations(string date)
        {
            var dateTime = new DateTime();
            var error = ValidateDate(date, ref dateTime);

            if (error != null)
            {
                return error;
            }

            var data = CenapredData.TryGetData(dateTime);

            if (data == null)
            {
                return NotFound();
            }

            return Ok(data.Exhalations);
        }

        [HttpGet(template: "{date}/phase", Name = "Phase")]
        public ActionResult Phase(string date)
        {
            var dateTime = new DateTime();
            var error = ValidateDate(date, ref dateTime);

            if (error != null)
            {
                return error;
            }

            var data = CenapredData.TryGetData(dateTime);

            if (data == null)
            {
                return NotFound();
            }

            return Ok(data.Phase);
        }

        [HttpGet(template: "{date}/directionOfPlume", Name = "Direction of Plume")]
        public ActionResult DirectionOfPlume(string date)
        {
            var dateTime = new DateTime();
            var error = ValidateDate(date, ref dateTime);

            if (error != null)
            {
                return error;
            }

            var data = CenapredData.TryGetData(dateTime);

            if (data == null)
            {
                return NotFound();
            }

            return Ok(data.DirectionOfPlume);
        }


        private ObjectResult? ValidateDate(string date, ref DateTime dateTime)
        {
            if (string.IsNullOrWhiteSpace(date))
            {
                return BadRequest("You must enter a date");
            }

            if (!DateTime.TryParse(date, out dateTime))
            {
                return BadRequest("Please enter a valid date in the form dd-MMM-YYYY such as 01-JAN-2023");
            }

            return null;
        }
    }
}