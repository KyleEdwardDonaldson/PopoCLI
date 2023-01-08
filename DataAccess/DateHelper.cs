using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace DataAccess
{
    public static class DateHelper
    {
        public static string ToSpanish(this int number, string type)
        {
            if (type.ToLower() == "month")
            {
                switch (number)
                {
                    case 1:
                        return "Enero";
                    case 2:
                        return "Febrero";
                    case 3:
                        return "Marzo";
                    case 4:
                        return "Abril";
                    case 5:
                        return "Mayo";
                    case 6:
                        return "Junio";
                    case 7:
                        return "Julio";
                    case 8:
                        return "Agosto";
                    case 9:
                        return "Septiembre";
                    case 10:
                        return "Octubre";
                    case 11:
                        return "Noviembre";
                    case 12:
                        return "Diciembre";
                }
            }

            return "N/A";
        }
    }
}
